export const ArrowIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const WifiIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M2 8.5a16 16 0 0120 0M5.5 12a11 11 0 0113 0M9 15.5a6 6 0 016 0" />
    <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const CoffeeIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5V9z" />
    <path d="M17 10h1.5a2.5 2.5 0 010 5H17M8 3c-.5 1 .5 1.5 0 3M12 3c-.5 1 .5 1.5 0 3" />
  </svg>
);

export const LeafIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M20 4C10 4 4 10 4 18c8 0 14-6 14-14z" />
    <path d="M6 18C10 14 14 10 19 5" />
  </svg>
);

export const UsersIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0113 0M15 5.3a3.2 3.2 0 010 6.2M21.5 20a6.3 6.3 0 00-5-6.1" />
  </svg>
);

export const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const ClockIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const CheckIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);

export const PinIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M12 21s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z" />
    <circle cx="12" cy="9" r="2.4" />
  </svg>
);

export const MailIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3.5 6.5L12 13l8.5-6.5" />
  </svg>
);

export const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M4 4.5h3.4l1.6 4.2-2 1.6a12.5 12.5 0 005.7 5.7l1.6-2 4.2 1.6V19a1.5 1.5 0 01-1.6 1.5C10 19.8 4.2 14 3.5 6.6 3.4 5.5 4 4.5 4 4.5z" />
  </svg>
);

export const DoorIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <path d="M14.5 12h.01" strokeWidth="2.4" />
  </svg>
);

export const MeetingIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <rect x="3" y="6.5" width="18" height="12" rx="2" />
    <path d="M7 6.5V5a2 2 0 012-2h6a2 2 0 012 2v1.5" />
  </svg>
);

export const MicIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M9 21h6" />
  </svg>
);

export const PawIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <circle cx="7" cy="8.5" r="1.6" />
    <circle cx="12" cy="6.5" r="1.6" />
    <circle cx="17" cy="8.5" r="1.6" />
    <path d="M12 12.5c-3.4 0-5.5 2-5.5 4.3 0 1.8 1.5 2.7 3 2.2 1.4-.5 1.7-.9 2.5-.9s1.1.4 2.5.9c1.5.5 3-.4 3-2.2 0-2.3-2.1-4.3-5.5-4.3z" />
  </svg>
);

export const SunIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
  </svg>
);

export const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" {...base}>
    <path d="M3 21l1.4-4.6A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.4-1.2L3 21zM8.5 8.6c-.1-.3-.3-.3-.5-.3h-.4a.9.9 0 00-.6.3 2.6 2.6 0 00-.8 1.9c0 1.1.8 2.2.9 2.4.1.1 1.6 2.6 4 3.5 2 .8 2.4.6 2.8.6.4 0 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1-.1-.1-.3-.2-.6-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.7.9c-.1.1-.3.2-.5.1-.4-.1-1.3-.5-2.2-1.4-.7-.7-1.2-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.1-.5l-.6-1.5z" />
  </svg>
);
