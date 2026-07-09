export interface ErrorContext {
  action: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

export function getErrorMessage(error: unknown, context: ErrorContext): string {
  let message = '';
  
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = 'Er is een onverwachte fout opgetreden';
  }
  
  // Add context-specific suggestions
  const suggestions: Record<string, string> = {
    'password': 'Controleer of uw wachtwoord correct is en probeer opnieuw.',
    'file': 'Controleer of het bestand bestaat en toegankelijk is.',
    'network': 'Controleer uw internetverbinding en probeer opnieuw.',
    'memory': 'Probeer een kleiner bestand of sluit andere applicaties.',
    'permission': 'Controleer of u de juiste permissies heeft.',
    'compression': 'Probeer met een lager compressieniveau.',
    'encryption': 'Controleer uw wachtwoord en probeer opnieuw.',
  };
  
  const suggestion = context.suggestion || suggestions[context.action] || 'Probeer opnieuw of neem contact op met support.';
  
  return `${message}\n\n${suggestion}`;
}

export function logError(error: unknown, context: ErrorContext): void {
  console.error(`[Error] ${context.action}:`, error);
  if (context.details) {
    console.error('[Error Details]:', context.details);
  }
}
