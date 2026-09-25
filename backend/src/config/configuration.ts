/** Typed, parsed view over process.env. Values are validated by validation.schema.ts before this runs. */
export default () => ({
  databaseUrl: process.env.DATABASE_URL,
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS),
    inviteTokenTtlHours: Number(process.env.INVITE_TOKEN_TTL_HOURS),
    resetTokenTtlHours: Number(process.env.RESET_TOKEN_TTL_HOURS),
    loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS),
    loginLockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES),
  },
});
