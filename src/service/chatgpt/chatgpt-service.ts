// import OpenAI from "openai";

// const client = new OpenAI({
//     apiKey: process.env.CHATGPT_API_KEY,
// });

// export type TranslationResult = {
//     id: string;
//     translated: string;
// };

// export async function translateBubbles(jsonData: string): Promise<TranslationResult[]> {
//     const prompt = `
//         You are a professional webtoon translator.

//         Translate the following English dialogue into natural Mongolian suitable for a manhwa.

//         IMPORTANT:
//         - Keep conversational flow between lines
//         - Do NOT translate each line independently
//         - Use natural spoken Mongolian (casual, emotional)
//         - Keep sentences short (fit in speech bubbles)
//         - Adapt meaning, not literal translation

//         Return ONLY an object with a property "translations" containing an array of objects:
//         [
//         { "id": string, "translated": string }
//         ]
//         Do not include explanations or other fields.

//         If you cannot complete the response, DO NOT return an error. Still return a partial JSON array.
//         Input:
//         ${jsonData}
// `;

//     const response = await client.chat.completions.create({
//         model: "gpt-5-mini",
//         messages: [
//             {
//                 role: "system",
//                 content: "You are a high-quality manhwa translator.",
//             },
//             {
//                 role: "user",
//                 content: prompt,
//             },
//         ],
//         response_format: {
//             type: "json_schema",
//             json_schema: {
//                 name: "translations",
//                 schema: {
//                     type: "object",
//                     properties: {
//                         translations: {
//                             type: "array",
//                             items: {
//                                 type: "object",
//                                 properties: {
//                                     id: { type: "string" },
//                                     translated: { type: "string" },
//                                 },
//                                 required: ["id", "translated"],
//                             },
//                         },
//                     },
//                     required: ["translations"],
//                 },
//             },
//         },
//     });

//     let content = response.choices[0].message.content?.trim();

//     if (!content) throw new Error("No response from AI");

//     // Remove leading non-JSON characters
//     const firstBrace = content.indexOf("{");
//     if (firstBrace !== 0) content = content.slice(firstBrace);

//     try {
//         const result = JSON.parse(content);
//         return result.translations;
//     } catch (err) {
//         console.error("Invalid JSON:", content);
//         throw new Error("Failed to parse AI response");
//     }
// }
