import { useCallback } from 'react';
import { useAuth } from '@/auth/auth';
import { bills } from './messages/bills';
import { common } from './messages/common';
import { manage } from './messages/manage';
import { mg } from './mg';

/** Dictionnaire français complet (langue par défaut). Le type des clés est vérifié à la compilation. */
export const fr = { ...common, ...bills, ...manage };
export type MessageKey = keyof typeof fr;
export type Locale = 'fr' | 'mg';

export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const template = (locale === 'mg' ? mg[key] : undefined) ?? fr[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function useT() {
  const { user } = useAuth();
  const locale: Locale = user?.locale === 'mg' ? 'mg' : 'fr';
  return useCallback((key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params), [locale]);
}
