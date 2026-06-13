export type GuardLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GuardLogEvent {
  event: string;
  level?: GuardLogLevel;
  message?: string;
  [key: string]: unknown;
}

export type GuardLogger = (event: GuardLogEvent) => void;

export interface GuardLoggingConfig {
  enabled?: boolean;
  service?: string;
  logger?: GuardLogger;
}

const consoleMethodByLevel: Record<GuardLogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
};

export function createLogger(config?: GuardLoggingConfig): GuardLogger {
  if (config?.enabled === false) {
    return () => undefined;
  }

  if (config?.logger) {
    return config.logger;
  }

  return event => {
    const level = event.level ?? 'info';
    const payload = {
      timestamp: new Date().toISOString(),
      service: config?.service ?? 'genkit-guard',
      level,
      ...event
    };

    console[consoleMethodByLevel[level]](JSON.stringify(payload));
  };
}
