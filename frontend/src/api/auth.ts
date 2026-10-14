// Auth endpoints: config, Google sign-in, and the signed-in user.

import { request } from './http.ts';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  image_token?: string;
}

export interface AuthResponse {
  token: string;
  image_token?: string;
  user: AuthUser;
}

export interface AuthConfig {
  auth_enabled: boolean;
  google_client_id: string;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  return (await request('/api/auth/config')).json();
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  return (await request('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  })).json();
}

export async function fetchMe(): Promise<AuthUser> {
  return (await request('/api/auth/me')).json();
}
