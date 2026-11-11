/**
 * The address people are sent to in invitations: the app on Inverse's own
 * domain (mail from info@inverse.ge with a link to inverse.ge is less likely
 * to land in spam). Local development keeps its own address.
 */
export function appUrlFrom(h: Headers): string {
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return process.env.APP_URL ?? 'https://app.inverse.ge';
}
