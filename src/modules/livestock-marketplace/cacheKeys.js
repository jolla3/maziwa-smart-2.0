export function publicAdCacheKey(adId) {
  return `ms2:public:livestock-ad:${adId}`;
}

export function publicAdLockKey(adId) {
  return `ms2:public:livestock-ad:lock:${adId}`;
}

export function publicAdGenKey(adId) {
  return `ms2:public:livestock-ad:gen:${adId}`;
}
