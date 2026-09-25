import Joi from 'joi';

export const validationSchema = Joi.object({
  DATABASE_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().positive().default(30),
  INVITE_TOKEN_TTL_HOURS: Joi.number().positive().default(72),
  RESET_TOKEN_TTL_HOURS: Joi.number().positive().default(1),
  LOGIN_MAX_ATTEMPTS: Joi.number().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: Joi.number().positive().default(15),
});
