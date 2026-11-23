import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

const SOCIAL_BOTS = ['Twitterbot', 'facebookexternalhit', 'Facebot', 'meta-externalagent', 'WhatsApp', 'LinkedInBot', 'TelegramBot', 'Slackbot', 'Discordbot', 'Pinterestbot'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/cuenta', '/mi-lista', '/buscar', '/*/ver$', '/media/subtitles/'] },
      // Bots que generan la vista previa al compartir un enlace: pueden leer también el reproductor (/ver)
      { userAgent: SOCIAL_BOTS, allow: '/', disallow: ['/admin', '/api/', '/cuenta', '/mi-lista'] },
    ],
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}
