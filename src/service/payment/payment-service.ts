import type { DecodedIdToken } from "../../types/firebase";
import { USER_DETAIL_PREFIX } from "../../const/redis-const";
import { pool } from "../../database";
import { redisDelete } from "../../database/redis";
import { sendDiscordMessage } from "../discord/discord-service";

export async function createInvoice(
  price: number,
  user: DecodedIdToken,
) {
  const result = await insertInvoice(price, user);
  return result;
}

async function insertInvoice(price: number, user: DecodedIdToken) {
  const { rows } = await pool.query(
    "SELECT * FROM qpay_account WHERE login_name = $1",
    ["HMANHWA_MN"],
  );
  const account = rows[0];

  const priceList = await pool.query(
    "SELECT * FROM sub_price WHERE price = $1",
    [price],
  );
  const priceRow = priceList.rows[0];

  const userList = await pool.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [user.uid],
  );
  const userInfo = userList.rows[0];

  const accessToken = await getAccessToken(account);
  const txnDesc = userInfo.email + " HManhwa төлбөр " + priceRow.price + "₮";

  const nextInvoiceNo = await getNextInvoiceNo();

  const invoiceRes = await fetch(account.url + "/v2/invoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify({
      invoice_code: "HMANHWA_MN_INVOICE",
      sender_invoice_no: userInfo.email,
      invoice_receiver_code: "terminal",
      invoice_description: txnDesc,
      amount: priceRow.price,
      callback_url:
        "https://webtoon-node-be-production.up.railway.app/api/public/callback?invoice_no=" +
        nextInvoiceNo,
    }),
  });

  if (!invoiceRes.ok) {
    console.log("Failed to create invoice:", await invoiceRes.text());
    throw new Error("Failed to create invoice");
  }

  if (!invoiceRes) {
    throw new Error("No response from invoice creation");
  }

  if (!invoiceRes.body) {
    throw new Error("No body in invoice response");
  }

  const invoiceResponse = await invoiceRes.json();

  await pool.query(
    "INSERT INTO qpay_invoice (invoice_id, invoice_no, amount, status, created_at, user_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      invoiceResponse.invoice_id,
      nextInvoiceNo,
      priceRow.price,
      "NEW",
      new Date(),
      userInfo.id,
    ],
  );

  return invoiceResponse;
}

export async function checkInvoiceById(invoiceId: string) {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM qpay_invoice WHERE invoice_id = $1",
      [invoiceId],
    );
    await checkPayment(rows[0].invoice_no);
  } catch (error) {
    console.error("Error checking payment:", error);
    throw error;
  }
}

export async function checkPayment(invoiceNo: number) {
  const { rows } = await pool.query(
    "SELECT * FROM qpay_account WHERE login_name = $1",
    ["HMANHWA_MN"],
  );
  const account = rows[0];
  const accessToken = await getAccessToken(account);

  const invoiceList = await pool.query(
    "SELECT * FROM qpay_invoice WHERE invoice_no = $1",
    [invoiceNo],
  );
  const invoice = invoiceList.rows[0];

  const paymentRes = await fetch(account.url + "/v2/payment/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify({
      object_type: "INVOICE",
      object_id: invoice.invoice_id,
    }),
  });

  if (!paymentRes.ok) {
    console.log("Failed to check payment:", await paymentRes.text());
    throw new Error("Failed to check payment");
  }

  if (invoice.status === "PAID") {
    return { message: "Invoice already paid" };
  }

  const paymentResponse = await paymentRes.json();

  if (Number(paymentResponse.paid_amount) === Number(invoice.amount)) {
    await pool.query(
      "UPDATE qpay_invoice SET status = 'PAID', paid_at = NOW() WHERE invoice_no = $1",
      [invoiceNo],
    );

    const priceList = await pool.query(
      "SELECT * FROM sub_price WHERE price = $1",
      [Number(invoice.amount)],
    );
    const priceRow = priceList.rows[0];

    const userList = await pool.query("SELECT * from users where id = $1", [
      invoice.user_id,
    ]);
    const userInfo = userList.rows[0];

    const cacheKey = USER_DETAIL_PREFIX + userInfo.firebase_uid;
    await redisDelete(cacheKey);

    const currentSubEnd = userInfo.sub_end_date
      ? new Date(userInfo.sub_end_date)
      : null;

    if (currentSubEnd) {
      if (currentSubEnd < new Date()) {
        const newSubEnd = new Date().setMonth(
          new Date().getMonth() + priceRow.month_amount,
        );
        await pool.query(
          "UPDATE users SET sub_start_date = NOW(), sub_end_date = $1 WHERE id = $2",
          [new Date(newSubEnd), invoice.user_id],
        );
      } else {
        const newSubEnd = new Date(currentSubEnd).setMonth(
          new Date(currentSubEnd).getMonth() + priceRow.month_amount,
        );
        await pool.query("UPDATE users SET sub_end_date = $1 WHERE id = $2", [
          new Date(newSubEnd),
          invoice.user_id,
        ]);
      }
    } else {
      await pool.query(
        `UPDATE users SET sub_start_date = NOW(), sub_end_date = NOW() + ($1 * INTERVAL '1 month') 
                 WHERE id = $2`,
        [priceRow.month_amount, invoice.user_id],
      );
    }

    sendDiscordMessage(
      `${userInfo.email} имэйлтэй хэрэглэгчийн төлбөр амжилттай хийгдлээ. ${invoice.amount}₮ төлсөн.  ${priceRow.month_amount} сараар сунгалаа.`,
    );
  } else {
    throw new Error("Paid amount does not match invoice amount");
  }
}

async function getNextInvoiceNo() {
  const { rows } = await pool.query(
    "SELECT nextval('invoice_number_seq') AS next_invoice_no",
  );
  return rows[0].next_invoice_no;
}

async function getAccessToken(account: any) {
  const credentials = account.login_name + ":" + account.password;
  const encodedCredentials = Buffer.from(credentials).toString("base64");

  const response = await fetch(account.url + "/v2/auth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + encodedCredentials,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  return data.access_token;
}
