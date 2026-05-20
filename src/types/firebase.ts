export interface DecodedIdToken {
  uid: string;
  user_id: string;
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  phone_number?: string;
  firebase: {
    identities: Record<string, any>;
    sign_in_provider: string;
    [key: string]: any;
  };
  [key: string]: any;
}
