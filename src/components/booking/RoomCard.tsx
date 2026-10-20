import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock, Users } from 'lucide-react';
import { fmtDuration, fmtMoney } from '../../lib/format';
import type { Room } from '../../types';

/** Cartão da sala (foto, preço, capacidade, comodidades). O cartão inteiro leva à página da sala. */
export function RoomCard({ room, to, index = 0 }: { room: Room; to: string; index?: number }) {
  return (
    <article
      style={{ animationDelay: `${index * 70}ms` }}
      className="animate-fade-up group relative flex flex-col overflow-hidden rounded-[26px] border border-ink/8 bg-cream transition-all duration-400 hover:-translate-y-1.5 hover:shadow-[0_34px_60px_-30px_rgba(44,54,39,0.45)]"
    >
      <Link to={to} aria-label={`Ver ${room.name} e reservar`} className="absolute inset-0 z-10 rounded-[26px] focus-visible:ring-4 focus-visible:ring-sage/40 focus-visible:outline-none" />
      <div className="relative aspect-[4/3] overflow-hidden bg-mist-light">
        {room.image && <img src={room.image} alt={room.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />}
        <span className="absolute top-4 right-4 rounded-full bg-cream/90 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink backdrop-blur">{fmtMoney(room.price_cents)}<span className="font-normal text-stone">/h</span></span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h2 className="font-display text-[22px] font-medium text-ink">{room.name}</h2>
        <p className="mt-1 text-[13.5px] text-stone">{room.tagline}</p>
        <div className="mt-4 flex gap-5 text-[13px] text-stone">
          <span className="inline-flex items-center gap-1.5"><Users size={15} className="text-sage-700" />até {room.capacity} pessoas</span>
          <span className="inline-flex items-center gap-1.5"><Clock size={15} className="text-sage-700" />mín. {fmtDuration(room.min_minutes)}</span>
        </div>
        <ul className="mt-5 flex flex-wrap gap-2">
          {room.amenities.map((a) => (
            <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-sage-dim px-3 py-1 text-[11.5px] font-medium text-sage-700"><Check size={11} />{a}</li>
          ))}
        </ul>
        <span className="mt-auto inline-flex items-center gap-2 pt-6 text-[13.5px] font-semibold text-sage-700">
          Ver sala e reservar <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </article>
  );
}
