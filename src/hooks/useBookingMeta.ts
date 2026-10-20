import { api } from '../services/api';
import type { BusinessHours, PublicSettings, Room } from '../types';
import { useApi } from './useApi';

/** Salas ativas, horário de funcionamento e regras — tudo que o formulário de reserva precisa. */
export function useBookingMeta() {
  const { data, loading, error } = useApi(async () => {
    const [rooms, settings] = await Promise.all([
      api.get<{ rooms: Room[] }>('/rooms'),
      api.get<{ settings: PublicSettings; hours: BusinessHours[] }>('/settings'),
    ]);
    return { rooms: rooms.rooms, settings: settings.settings, hours: settings.hours };
  }, []);
  return { meta: data, loading, error };
}
