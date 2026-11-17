/**
 * ============================================================================
 * MODULE: NESTJS ICE/TURN - ICE SERVER PROVISIONING SERVICE
 * ============================================================================
 * Cung cấp danh sách máy chủ STUN & TURN động cho WebRTC clients:
 *  - Luôn bao gồm các máy chủ STUN công cộng (Google, Cloudflare).
 *  - Hỗ trợ đọc cấu hình TURN từ biến môi trường (Railway / .env) mà không
 *    cần build lại frontend:
 *      1. Metered.ca API (khuyên dùng - miễn phí 20GB/tháng, hỗ trợ port 80/443/TURNS):
 *         METERED_DOMAIN (vd: myapp.metered.live) + METERED_API_KEY
 *      2. Cloudflare Calls TURN API:
 *         CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
 *      3. TURN tĩnh (Coturn / Metered static / Xirsys / Twilio):
 *         TURN_URLS (phân tách dấu phẩy), TURN_USERNAME, TURN_CREDENTIAL
 *      4. JSON tùy chỉnh:
 *         TURN_ICE_SERVERS_JSON
 */

import { Injectable } from '@nestjs/common';

export interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  iceServers: IceServerEntry[];
  hasTurn: boolean;
  provider: 'metered' | 'cloudflare' | 'custom' | 'stun-only';
}

const DEFAULT_STUN_SERVERS: IceServerEntry[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

@Injectable()
export class IceService {
  private cachedResult: { data: IceServersResponse; expiresAt: number } | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // Cache 5 phút cho API động

  /**
   * Lấy danh sách ICE servers (STUN + TURN nếu được cấu hình)
   */
  public async getIceServers(): Promise<IceServersResponse> {
    const now = Date.now();
    if (this.cachedResult && now < this.cachedResult.expiresAt) {
      return this.cachedResult.data;
    }

    // 1. Kiểm tra JSON tùy chỉnh: TURN_ICE_SERVERS_JSON
    const rawJson = process.env.TURN_ICE_SERVERS_JSON?.trim();
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const merged = this.mergeWithStun(parsed);
          return {
            iceServers: merged,
            hasTurn: this.containsTurnServer(merged),
            provider: 'custom'
          };
        }
      } catch (err) {
        console.warn('[IceService] TURN_ICE_SERVERS_JSON không hợp lệ:', err);
      }
    }

    // 2. Kiểm tra TURN tĩnh: TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
    const turnUrlsRaw = (process.env.TURN_URLS || process.env.TURN_URL || '').trim();
    const turnUsername = process.env.TURN_USERNAME?.trim();
    const turnCredential = process.env.TURN_CREDENTIAL?.trim();

    if (turnUrlsRaw) {
      const urls = turnUrlsRaw
        .split(',')
        .map(u => u.trim())
        .filter(Boolean);

      if (urls.length > 0) {
        const turnEntries: IceServerEntry[] = urls.map(url => ({
          urls: url,
          ...(turnUsername ? { username: turnUsername } : {}),
          ...(turnCredential ? { credential: turnCredential } : {})
        }));
        const merged = this.mergeWithStun(turnEntries);
        return {
          iceServers: merged,
          hasTurn: this.containsTurnServer(merged),
          provider: 'custom'
        };
      }
    }

    // 3. Kiểm tra Metered.ca API: METERED_DOMAIN (hoặc METERED_APP_NAME) + METERED_API_KEY
    const meteredDomainRaw = (process.env.METERED_DOMAIN || process.env.METERED_APP_NAME || '').trim();
    const meteredApiKey = process.env.METERED_API_KEY?.trim();

    if (meteredDomainRaw && meteredApiKey) {
      const domain = meteredDomainRaw.includes('.')
        ? meteredDomainRaw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
        : `${meteredDomainRaw}.metered.live`;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(
          `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`,
          { signal: controller.signal }
        );
        clearTimeout(timer);

        if (res.ok) {
          const payload = (await res.json()) as IceServerEntry[];
          if (Array.isArray(payload) && payload.length > 0) {
            const merged = this.mergeWithStun(payload);
            const result: IceServersResponse = {
              iceServers: merged,
              hasTurn: this.containsTurnServer(merged),
              provider: 'metered'
            };
            this.cachedResult = { data: result, expiresAt: now + this.cacheTtlMs };
            return result;
          }
        } else {
          console.warn(`[IceService] Metered API trả về HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn('[IceService] Không thể lấy TURN credentials từ Metered API:', err);
      }
    }

    // 4. Kiểm tra Cloudflare Calls TURN API: CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
    const cfKeyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
    const cfToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();

    if (cfKeyId && cfToken) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfKeyId)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ttl: 86400 }),
            signal: controller.signal
          }
        );
        clearTimeout(timer);

        if (res.ok) {
          const json = (await res.json()) as { iceServers?: IceServerEntry[] };
          if (Array.isArray(json?.iceServers) && json.iceServers.length > 0) {
            const merged = this.mergeWithStun(json.iceServers);
            const result: IceServersResponse = {
              iceServers: merged,
              hasTurn: this.containsTurnServer(merged),
              provider: 'cloudflare'
            };
            this.cachedResult = { data: result, expiresAt: now + this.cacheTtlMs };
            return result;
          }
        } else {
          console.warn(`[IceService] Cloudflare TURN API trả về HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn('[IceService] Không thể lấy TURN credentials từ Cloudflare:', err);
      }
    }

    // Fallback mặc định: chỉ có STUN (hoạt động tốt cùng mạng / NAT mở)
    return {
      iceServers: DEFAULT_STUN_SERVERS,
      hasTurn: false,
      provider: 'stun-only'
    };
  }

  private mergeWithStun(customServers: IceServerEntry[]): IceServerEntry[] {
    return [...DEFAULT_STUN_SERVERS, ...customServers];
  }

  private containsTurnServer(servers: IceServerEntry[]): boolean {
    return servers.some(entry => {
      const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
      return urls.some(u => typeof u === 'string' && /^turns?:/i.test(u.trim()));
    });
  }
}
