import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { PageHeader } from '../../components/ui/Misc';
import { RoomCard } from '../../components/booking/RoomCard';
import { useApi } from '../../hooks/useApi';
import { api } from '../../services/api';
import type { Room } from '../../types';

export default function RoomsCatalog() {
  const q = useApi(() => api.get<{ rooms: Room[] }>('/rooms'), []);

  return (
    <>
      <PageHeader eyebrow="Espaços" title="Nossas salas" description="Cada sala foi pensada para acolher bem o seu trabalho. Escolha a que combina com o momento." />
      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {q.loading && !q.data
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px] rounded-[26px]" />)
          : q.data?.rooms.map((room, i) => <RoomCard key={room.id} room={room} to={`/app/salas/${room.slug}`} index={i} />)}
      </div>
    </>
  );
}
