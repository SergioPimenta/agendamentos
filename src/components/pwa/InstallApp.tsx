import { useState } from 'react';
import { Download, MoreVertical, PlusSquare, Share } from 'lucide-react';
import { detectPlatform, usePwaInstall } from '../../hooks/usePwaInstall';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const STEPS = {
  ios: [
    { icon: Share, text: 'No Safari, toque em Compartilhar (o quadrado com a seta para cima).' },
    { icon: PlusSquare, text: 'Role a lista e toque em “Adicionar à Tela de Início”.' },
    { icon: Download, text: 'Confirme em “Adicionar”. O ícone da harmonizeoser aparece na sua tela.' },
  ],
  android: [
    { icon: MoreVertical, text: 'No Chrome, toque nos três pontinhos no canto superior.' },
    { icon: PlusSquare, text: 'Escolha “Instalar app” (ou “Adicionar à tela inicial”).' },
    { icon: Download, text: 'Confirme. O app aparece junto com os seus outros aplicativos.' },
  ],
  desktop: [
    { icon: Download, text: 'No Chrome ou Edge, clique no ícone de instalar no fim da barra de endereço.' },
    { icon: MoreVertical, text: 'Ou abra o menu (três pontinhos) e escolha “Instalar harmonizeoser”.' },
    { icon: PlusSquare, text: 'Para instalar no celular, abra este mesmo endereço no navegador do aparelho.' },
  ],
} as const;

type Variant = 'ghost' | 'soft' | 'light' | 'outline-light' | 'secondary';

/** Botão "Baixar app": instala o PWA com um toque quando o navegador permite; senão mostra o passo a passo. */
export function InstallAppButton({ className, variant = 'ghost', label = 'Baixar app' }: { className?: string; variant?: Variant; label?: string }) {
  const { installed, canPrompt, install } = usePwaInstall();
  const [help, setHelp] = useState(false);
  if (installed) return null;

  const platform = detectPlatform();
  const steps = STEPS[platform];

  const onClick = async () => {
    if (canPrompt && (await install())) return;
    setHelp(true);
  };

  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={onClick} className={className}>
        <Download size={15} /> {label}
      </Button>
      <Modal open={help} onClose={() => setHelp(false)} size="sm" title="Instalar o app" subtitle="Reserve salas direto da tela inicial do seu celular, sem abrir o navegador.">
        <ol className="flex flex-col gap-4">
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex items-start gap-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sage-dim text-sage-700"><Icon size={17} /></span>
              <p className="pt-1.5 text-[14px] leading-snug text-ink">{text}</p>
            </li>
          ))}
        </ol>
        {platform === 'ios' && <p className="mt-5 text-[12.5px] text-stone">No iPhone a instalação só funciona pelo Safari.</p>}
      </Modal>
    </>
  );
}
