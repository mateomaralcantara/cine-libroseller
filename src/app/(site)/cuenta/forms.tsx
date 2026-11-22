'use client';
import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { loginAction, registerAction, savePreferences, type FormState } from './actions';

function Alert({ state }: { state: FormState }) {
  if (state?.error) return <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>;
  if (state?.ok) return <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{state.ok}</p>;
  return null;
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      <Alert state={state} />
      <input type="hidden" name="next" value={next} />
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="field" /></div>
      <div><label className="label" htmlFor="password">Contraseña</label><input id="password" name="password" type="password" required autoComplete="current-password" className="field" /></div>
      <button className="btn btn-gold mt-2" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
      <p className="text-center text-sm text-mist">¿No tienes cuenta? <Link href={`/cuenta/registro?next=${encodeURIComponent(next)}`} className="text-gold-soft underline">Crear cuenta gratis</Link></p>
    </form>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(registerAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      <Alert state={state} />
      <input type="hidden" name="next" value={next} />
      <div className="hidden" aria-hidden><label>Web<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div><label className="label" htmlFor="name">Nombre</label><input id="name" name="name" required maxLength={80} autoComplete="name" className="field" /></div>
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="field" aria-invalid={state?.field === 'email'} /></div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="field" aria-describedby="pw-help" aria-invalid={state?.field === 'password'} />
        <p id="pw-help" className="mt-1 text-xs text-dim">Mínimo 10 caracteres, con letras y números.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-mist"><input type="checkbox" name="terms" required className="mt-1 accent-[var(--color-gold)]" /> Acepto la <Link href="/privacidad" className="text-gold-soft underline">política de privacidad</Link>.</label>
      <label className="flex items-start gap-2 text-sm text-mist"><input type="checkbox" name="marketing" className="mt-1 accent-[var(--color-gold)]" /> Quiero recibir novedades y estrenos por correo (opcional).</label>
      <button className="btn btn-gold mt-2" disabled={pending}>{pending ? 'Creando…' : 'Crear cuenta'}</button>
      <p className="text-center text-sm text-mist">¿Ya tienes cuenta? <Link href={`/cuenta/entrar?next=${encodeURIComponent(next)}`} className="text-gold-soft underline">Entrar</Link></p>
    </form>
  );
}

export function PreferencesForm({ prefs, profileName, marketing }: { prefs: { subtitle_language: string | null; subtitle_size: string; autoplay_next: boolean; autoplay_previews: boolean; data_saver: boolean }; profileName: string; marketing: boolean }) {
  const [state, action, pending] = useActionState(savePreferences, undefined);
  useEffect(() => {
    // El reproductor lee estas preferencias en el dispositivo
    if (state?.ok) {
      try {
        const f = document.getElementById('prefs') as HTMLFormElement;
        localStorage.setItem('cls_autoplay_next', (f.elements.namedItem('autoplay_next') as HTMLInputElement).checked ? 'on' : 'off');
        localStorage.setItem('cls_autoplay_previews', (f.elements.namedItem('autoplay_previews') as HTMLInputElement).checked ? 'on' : 'off');
        localStorage.setItem('cls_sub_size', (f.elements.namedItem('subtitle_size') as HTMLSelectElement).value);
        const lang = (f.elements.namedItem('subtitle_language') as HTMLSelectElement).value;
        localStorage.setItem('cls_sub_lang', lang || 'off');
      } catch { /* */ }
    }
  }, [state]);
  return (
    <form id="prefs" action={action} className="grid gap-4">
      <Alert state={state} />
      <div><label className="label" htmlFor="profile_name">Nombre del perfil</label><input id="profile_name" name="profile_name" defaultValue={profileName} maxLength={60} className="field" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="subtitle_language">Subtítulos por defecto</label>
          <select id="subtitle_language" name="subtitle_language" defaultValue={prefs.subtitle_language ?? ''} className="field">
            <option value="">Desactivados</option><option value="es">Español</option><option value="en">Inglés</option><option value="pt">Portugués</option><option value="fr">Francés</option>
          </select></div>
        <div><label className="label" htmlFor="subtitle_size">Tamaño de subtítulos</label>
          <select id="subtitle_size" name="subtitle_size" defaultValue={prefs.subtitle_size} className="field">
            <option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option>
          </select></div>
      </div>
      {[
        ['autoplay_next', 'Reproducir automáticamente el siguiente episodio', prefs.autoplay_next],
        ['autoplay_previews', 'Mostrar avances en movimiento en las portadas', prefs.autoplay_previews],
        ['data_saver', 'Ahorro de datos (empieza en calidad baja)', prefs.data_saver],
        ['marketing', 'Recibir novedades y estrenos por correo', marketing],
      ].map(([name, label, checked]) => (
        <label key={String(name)} className="flex items-center gap-3 text-sm"><input type="checkbox" name={String(name)} defaultChecked={!!checked} className="h-4 w-4 accent-[var(--color-gold)]" /> {String(label)}</label>
      ))}
      <button className="btn btn-gold justify-self-start" disabled={pending}>Guardar</button>
    </form>
  );
}
