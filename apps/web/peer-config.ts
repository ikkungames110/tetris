import type { PeerOptions } from 'peerjs';

export function peerOptions(extra: RTCIceServer[] = []): PeerOptions {
  const stun = import.meta.env.VITE_STUN_URL ?? 'stun:stun.l.google.com:19302';
  const options: PeerOptions = {
    secure: true,
    config: { iceServers: [...(stun === 'none' ? [] : [{ urls: stun }]), ...extra] },
  };
  if (import.meta.env.VITE_PEER_HOST)
    Object.assign(options, {
      host: import.meta.env.VITE_PEER_HOST,
      port: Number(import.meta.env.VITE_PEER_PORT ?? 443),
      path: import.meta.env.VITE_PEER_PATH ?? '/',
      secure: import.meta.env.VITE_PEER_SECURE !== 'false',
    });
  return options;
}
