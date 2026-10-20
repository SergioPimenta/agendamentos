import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { PageHeader } from '../../components/ui/Misc';
import { BrandLogo } from '../../components/brand/brand';
import { useApi } from '../../hooks/useApi';
import { api } from '../../services/api';
import type { Room } from '../../types';

/** Endereço que o QR abre: a página de check-in/check-out da sala (o cliente entra com a conta dele). */
const sessionUrl = (slug: string) => `${window.location.origin}/app/sessao/${slug}`;

export default function AdminQrCodes() {
  const q = useApi(() => api.get<{ rooms: Room[] }>('/rooms'), []);
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    const rooms = q.data?.rooms ?? [];
    let alive = true;
    Promise.all(
      rooms.map(async (r) => [r.slug, await QRCode.toDataURL(sessionUrl(r.slug), { width: 640, margin: 1, color: { dark: '#262a22', light: '#ffffff' } })] as const),
    ).then((pairs) => alive && setCodes(Object.fromEntries(pairs)));
    return () => { alive = false; };
  }, [q.data]);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          eyebrow="Uso da sala"
          title="QR codes das salas"
          description="Imprima e cole um QR na porta de cada sala. O cliente escaneia, entra na conta dele e faz check-in ou check-out em um toque — só funciona para quem tem reserva naquela sala."
          actions={<Button icon={<Printer size={16} />} onClick={() => window.print()}>Imprimir todos</Button>}
        />
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 print:block">
        {q.loading && !q.data
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[460px] rounded-[26px]" />)
          : q.data?.rooms.map((room) => (
              <article key={room.id} className="flex flex-col items-center rounded-[26px] border border-ink/8 bg-cream p-7 text-center break-inside-avoid print:mx-auto print:mb-0 print:min-h-[95vh] print:max-w-[520px] print:justify-center print:break-after-page print:border-0">
                <BrandLogo size="md" />
                <h2 className="mt-5 font-display text-[26px] leading-tight font-medium text-ink">{room.name}</h2>
                <p className="mt-1 text-[14px] text-stone">Check-in e check-out</p>

                <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-3">
                  {codes[room.slug] ? <img src={codes[room.slug]} alt={`QR code da ${room.name}`} className="h-[220px] w-[220px] print:h-[340px] print:w-[340px]" /> : <Skeleton className="h-[220px] w-[220px]" />}
                </div>

                <ol className="mt-5 list-decimal space-y-1 pl-5 text-left text-[13px] leading-snug text-stone print:text-[15px]">
                  <li>Aponte a câmera do celular para o código.</li>
                  <li>Entre na sua conta, se for pedido.</li>
                  <li>Toque em <strong className="text-ink">Fazer check-in</strong> ao chegar e em <strong className="text-ink">Encerrar uso</strong> ao sair.</li>
                </ol>

                <p className="mt-4 text-[11px] break-all text-stone-light">{sessionUrl(room.slug)}</p>

                {codes[room.slug] && (
                  <a
                    href={codes[room.slug]}
                    download={`qr-${room.slug}.png`}
                    className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-sage-700 no-underline hover:underline print:hidden"
                  >
                    <Download size={15} />Baixar PNG
                  </a>
                )}
              </article>
            ))}
      </div>
    </>
  );
}
