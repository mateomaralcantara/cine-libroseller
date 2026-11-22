// Reglas de negocio que el CRUD genérico no puede expresar.
import { HttpError } from './validate.js';
import { getSetting } from './db.js';

export const LIKENESS_TECHNIQUES = ['reemplazo_rostro', 'rejuvenecimiento', 'ia_generativa', 'relighting'];
export const VOICE_TECHNIQUES = ['voz_ia'];
const OK_CONSENT = ['otorgado', 'limitado'];

const today = () => new Date().toISOString().slice(0, 10);

function consentValid(t, field) {
  if (!t) return true;
  if (t.kind === 'interprete_digital' && t[field] === 'no_aplica') return true;
  if (!OK_CONSENT.includes(t[field])) return false;
  if (t.consent_expires && t.consent_expires < today()) return false;
  return true;
}

/**
 * Devuelve los problemas de derechos de imagen/voz que impiden aprobar un plano.
 * Un plano que altera o sintetiza a una persona real necesita su consentimiento vigente.
 */
export function shotConsentIssues(db, shot) {
  const issues = [];
  const needsLikeness = LIKENESS_TECHNIQUES.includes(shot.technique);
  const needsVoice = VOICE_TECHNIQUES.includes(shot.technique);
  if (!needsLikeness && !needsVoice) return issues;
  if (!shot.character_id) {
    if (shot.technique !== 'ia_generativa') issues.push('La técnica requiere indicar el personaje afectado');
    return issues;
  }
  const ch = db.prepare('SELECT * FROM characters WHERE id = ?').get(shot.character_id);
  if (!ch) return ['El personaje indicado no existe'];
  const talent = (id) => (id ? db.prepare('SELECT * FROM talent WHERE id = ?').get(id) : null);
  if (needsLikeness) {
    for (const t of [talent(ch.actor_id), talent(ch.digital_double_id)]) {
      if (t && !consentValid(t, 'likeness_consent')) {
        issues.push(`${t.name}: consentimiento de imagen ${t.likeness_consent}${t.consent_expires && t.consent_expires < today() ? ' (vencido)' : ''}`);
      }
    }
  }
  if (needsVoice) {
    const v = talent(ch.voice_id) || talent(ch.actor_id);
    if (v && !consentValid(v, 'voice_consent')) issues.push(`${v.name}: consentimiento de voz ${v.voice_consent}`);
  }
  return issues;
}

export const hooks = {
  projects: {
    beforeInsert(db, data) {
      const year = new Date().getFullYear();
      const last = db.prepare(`SELECT code FROM projects WHERE code LIKE ? ORDER BY id DESC LIMIT 1`).get(`CLS-${year}-%`);
      const seq = last ? Number(last.code.split('-')[2]) + 1 : 1;
      data.code = `CLS-${year}-${String(seq).padStart(4, '0')}`;
    },
  },
  shots: {
    beforeWrite(db, data, existing) {
      const merged = { ...existing, ...data };
      if (['reemplazo_rostro', 'rejuvenecimiento', 'voz_ia'].includes(merged.technique) && !merged.character_id) {
        throw new HttpError(422, 'Revisa los campos marcados', { character_id: 'Esta técnica requiere indicar el personaje afectado' });
      }
      if (merged.status === 'aprobado' && (!existing || existing.status !== 'aprobado')) {
        const issues = shotConsentIssues(db, merged);
        if (issues.length) {
          throw new HttpError(409, 'No se puede aprobar: faltan consentimientos de la persona real', { status: issues.join('; ') });
        }
      }
      if (existing && data.status === 'revision' && existing.status !== 'revision') {
        data.iterations = (existing.iterations || 0) + 1;
      }
    },
  },
  versions: {
    beforeInsert(_db, data, req) {
      data.status = 'en_revision';
      data.submitted_by = req.user.id;
    },
  },
};

export function fxRates(db) {
  return getSetting(db, 'fx_rates', { USD: 1 });
}

/** Convierte un monto a USD con las tasas configuradas (unidades de moneda por 1 USD). */
export function toUSD(rates, amount, currency) {
  const r = rates[currency || 'USD'] || 1;
  return (Number(amount) || 0) / r;
}
