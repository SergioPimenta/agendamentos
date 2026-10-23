/** Áreas de atuação do cadastro. As que pedem detalhe (`ask`) abrem um campo de texto para especificar. */
export interface ActivityArea { label: string; ask?: string }

export const ACTIVITY_AREAS: ActivityArea[] = [
  { label: 'Aromaterapia' },
  { label: 'Barras de Access' },
  { label: 'Coaching Vocacional/Emocional' },
  { label: 'Constelação Familiar/Sistêmica' },
  { label: 'Cromoterapia' },
  { label: 'Cursos e Treinamentos', ask: 'a área' },
  { label: 'Fitoterapia' },
  { label: 'Florais de Bach' },
  { label: 'Hipnoterapia' },
  { label: 'Homeopata' },
  { label: 'Massoterapia' },
  { label: 'Medicina Antroposófica' },
  { label: 'Medicina Ayurvédica' },
  { label: 'Medicina Tradicional Chinesa', ask: 'as práticas' },
  { label: 'Meditação Guiada' },
  { label: 'Mentoria' },
  { label: 'Naturopatia' },
  { label: 'Neurologista' },
  { label: 'Nutrição' },
  { label: 'Orientação Pedagógica' },
  { label: 'Psicanálise' },
  { label: 'Psicologia' },
  { label: 'Psicopedagogia' },
  { label: 'Psiquiatria' },
  { label: 'Quiropraxia e Osteopatia' },
  { label: 'Reflexologia' },
  { label: 'Reiki' },
  { label: 'Terapia Integrativa', ask: 'as práticas' },
  { label: 'Outras Atividades de Saúde', ask: 'a atividade' },
  { label: 'Outros Ramos de Atividade', ask: 'o ramo' },
];

const ROLE_MAX = 80; // tamanho do campo "cargo/função" no cadastro da pessoa

/** Quantos caracteres sobram para o detalhe depois do nome da área ("Área: detalhe"). */
export const detailMax = (area: ActivityArea) => ROLE_MAX - area.label.length - 2;

/** Texto gravado no cadastro: o nome da área, com o detalhe quando a área pede. */
export function areaValue(label: string, detail: string): string {
  const area = ACTIVITY_AREAS.find((a) => a.label === label);
  if (!area) return '';
  const d = detail.trim().slice(0, detailMax(area));
  return area.ask && d ? `${area.label}: ${d}` : area.label;
}
