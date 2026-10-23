// Auth endpoints: config, Google sign-in, and the signed-in user.

import type { Settings } from '../types.ts';
import { request } from './http.ts';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

// /me also hands out a fresh image token ("" in solo mode) and the user's
// default pricing (null until one is set).
export type MeResponse = AuthUser & { image_token: string; pricing: Settings | null };

export interface AuthResponse {
  token: string;
  image_token: string;
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

export async function fetchMe(): Promise<MeResponse> {
  return (await request('/api/auth/me')).json();
}

// Sets the user's default pricing. `keepalive` lets it finish as the page closes.
export async function saveDefaultPricing(pricing: Settings, keepalive = false): Promise<void> {
  await request('/api/auth/me/pricing', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pricing }),
    keepalive,
  });
}
