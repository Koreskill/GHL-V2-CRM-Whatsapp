// Estados de una propiedad: el valor guardado, cómo lo ve una persona y con qué tono. Función pura, sin base,
// para que el catálogo, la ficha y el organizador digan lo mismo.

export const PROPERTY_STATUSES = ["disponible", "reservada", "senada", "vendida", "alquilada", "pausada", "borrador"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

// "disponible" se muestra como "Activa": es el nombre con el que el equipo habla de la propiedad.
export const STATUS_LABEL: Record<PropertyStatus, string> = {
  disponible: "Activa",
  reservada: "Reservada",
  senada: "Señada",
  vendida: "Vendida",
  alquilada: "Alquilada",
  pausada: "Pausada",
  borrador: "Borrador",
};

export const STATUS_TONE: Record<PropertyStatus, string> = {
  disponible: "bg-accent-green/12 text-accent-green",
  reservada: "bg-accent-amber/12 text-accent-amber",
  senada: "bg-accent-purple/12 text-accent-purple",
  vendida: "bg-field text-muted",
  alquilada: "bg-field text-muted",
  pausada: "bg-field text-muted",
  borrador: "bg-field text-muted",
};

export const statusLabel = (status: string): string => STATUS_LABEL[status as PropertyStatus] ?? status;
export const statusTone = (status: string): string => STATUS_TONE[status as PropertyStatus] ?? "bg-field text-muted";

// Estados que se ofrecen a un cliente. Una "señada" ya tiene seña: no se ofrece, igual que una vendida.
export const OFFERABLE_PROPERTY_STATUSES = ["disponible", "reservada"] as const;
