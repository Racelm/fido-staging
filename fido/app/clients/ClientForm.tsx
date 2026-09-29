'use client'

import { useActionState } from 'react'
import { createClientRecord } from '@/app/actions/clients'

const initialState = { error: '', success: false }

export default function ClientForm() {
  const [state, action, pending] = useActionState(
    async (_state: typeof initialState, formData: FormData) => {
      const result = await createClientRecord(formData)
      return result.success
        ? { error: '', success: true }
        : { error: result.error || 'Une erreur est survenue.', success: false }
    },
    initialState
  )

  return (
    <form action={action} className="client-form" data-testid="client-form">
      <input
        className="search auth-input"
        name="company_name"
        placeholder="Nom de l’entreprise *"
        required
        data-testid="client-company"
      />
      <input
        className="search auth-input"
        name="contact_name"
        placeholder="Nom du contact"
        data-testid="client-contact"
      />
      <input
        className="search auth-input"
        name="email"
        type="email"
        placeholder="E-mail"
        data-testid="client-email"
      />
      <input
        className="search auth-input"
        name="phone"
        placeholder="Téléphone (+212...)"
        data-testid="client-phone"
      />

      <div className="grid-2">
        <input className="search auth-input" name="ice" placeholder="ICE" data-testid="client-ice" />
        <input
          className="search auth-input"
          name="if_number"
          placeholder="IF (identifiant fiscal)"
          data-testid="client-if"
        />
      </div>
      <div className="grid-2">
        <input
          className="search auth-input"
          name="rc_number"
          placeholder="Registre de commerce"
          data-testid="client-rc"
        />
        <input
          className="search auth-input"
          name="cnss_number"
          placeholder="N° CNSS"
          data-testid="client-cnss"
        />
      </div>
      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Période TVA</span>
          <select
            className="search"
            name="tva_period"
            defaultValue=""
            data-testid="client-tva"
          >
            <option value="">— non défini —</option>
            <option value="mensuel">Mensuelle</option>
            <option value="trimestriel">Trimestrielle</option>
            <option value="exonere">Exonéré</option>
          </select>
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Début d’exercice</span>
          <input
            className="search"
            name="fiscal_year_start"
            type="date"
            data-testid="client-fiscal-start"
          />
        </label>
      </div>

      {state.error && <p className="auth-error">{state.error}</p>}
      {state.success && (
        <p className="auth-notice">
          Client ajouté. Les échéances fiscales de l’année ont été générées automatiquement.
        </p>
      )}
      <button
        className="primary auth-submit"
        disabled={pending}
        data-testid="client-submit"
      >
        {pending ? 'Ajout en cours...' : 'Ajouter le client'}
      </button>
    </form>
  )
}
