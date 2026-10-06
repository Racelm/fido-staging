'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateClientRecord } from '@/app/actions/clients'

type ClientRow = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
  ice: string | null
  if_number: string | null
  rc_number: string | null
  cnss_number: string | null
  patente_number: string | null
  tva_period: string | null
  fiscal_year_start: string | null
  status: string
}

type State = { error: string; success: boolean }
const initialState: State = { error: '', success: false }

export default function EditClientForm({ client }: { client: ClientRow }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: State, formData: FormData) => {
      const result = await updateClientRecord(client.id, formData)
      if (result.success) {
        router.push(`/clients/${client.id}`)
        router.refresh()
        return { error: '', success: true }
      }
      return { error: result.error || 'Une erreur est survenue.', success: false }
    },
    initialState
  )

  return (
    <form action={action} className="client-form" data-testid="edit-client-form">
      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Nom de l’entreprise *</span>
        <input
          className="search auth-input"
          name="company_name"
          defaultValue={client.company_name}
          required
          data-testid="edit-company"
        />
      </label>

      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Contact</span>
          <input
            className="search auth-input"
            name="contact_name"
            defaultValue={client.contact_name || ''}
            data-testid="edit-contact"
          />
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">E-mail</span>
          <input
            className="search auth-input"
            name="email"
            type="email"
            defaultValue={client.email || ''}
            data-testid="edit-email"
          />
        </label>
      </div>

      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Téléphone</span>
          <input
            className="search auth-input"
            name="phone"
            defaultValue={client.phone || ''}
            placeholder="+212..."
            data-testid="edit-phone"
          />
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Statut</span>
          <select
            className="search"
            name="status"
            defaultValue={client.status}
            data-testid="edit-status"
          >
            <option value="active">Actif</option>
            <option value="invited">Invité</option>
            <option value="inactive">Inactif</option>
          </select>
        </label>
      </div>

      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Adresse</span>
        <input
          className="search auth-input"
          name="address"
          defaultValue={client.address || ''}
          placeholder="Rue, ville, code postal"
          data-testid="edit-address"
        />
      </label>

      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Site web</span>
        <input
          className="search auth-input"
          name="website"
          defaultValue={client.website || ''}
          placeholder="https://..."
          data-testid="edit-website"
        />
      </label>

      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">ICE</span>
          <input className="search auth-input" name="ice" defaultValue={client.ice || ''} data-testid="edit-ice" />
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">IF (identifiant fiscal)</span>
          <input className="search auth-input" name="if_number" defaultValue={client.if_number || ''} data-testid="edit-if" />
        </label>
      </div>

      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Registre de commerce</span>
          <input className="search auth-input" name="rc_number" defaultValue={client.rc_number || ''} data-testid="edit-rc" />
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">N° CNSS</span>
          <input className="search auth-input" name="cnss_number" defaultValue={client.cnss_number || ''} data-testid="edit-cnss" />
        </label>
      </div>

      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">N° patente</span>
          <input
            className="search auth-input"
            name="patente_number"
            defaultValue={client.patente_number || ''}
            data-testid="edit-patente"
          />
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Période TVA</span>
          <select
            className="search"
            name="tva_period"
            defaultValue={client.tva_period || ''}
            data-testid="edit-tva"
          >
            <option value="">— non défini —</option>
            <option value="mensuel">Mensuelle</option>
            <option value="trimestriel">Trimestrielle</option>
            <option value="exonere">Exonéré</option>
          </select>
        </label>
      </div>

      <label className="upload-label" style={{ margin: 0 }}>
        <span className="muted">Début d’exercice</span>
        <input
          className="search"
          name="fiscal_year_start"
          type="date"
          defaultValue={client.fiscal_year_start || ''}
          data-testid="edit-fiscal-start"
        />
      </label>

      {state.error && (
        <p className="auth-error" data-testid="edit-error">{state.error}</p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          className="primary auth-submit"
          disabled={pending}
          data-testid="edit-submit"
          style={{ flex: 1 }}
        >
          {pending ? 'Enregistrement...' : 'Enregistrer les modifications'}
        </button>
        <Link
          href={`/clients/${client.id}`}
          className="btn-secondary"
          style={{ textAlign: 'center' }}
          data-testid="edit-cancel"
        >
          Annuler
        </Link>
      </div>
    </form>
  )
}
