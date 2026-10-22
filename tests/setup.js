process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/maziwa_smart_v2_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-not-for-production';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173,https://example.test';
