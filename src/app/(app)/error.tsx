"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui/primitives";

// Pantalla de error sin detalles técnicos: el mensaje real queda solo en los logs del servidor.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={AlertCircle}
        title="Algo salió mal"
        description="No pudimos cargar esta pantalla. Prueba de nuevo en unos segundos."
        className="py-20"
      />
      <div className="flex justify-center pb-10">
        <Button variant="secondary" onClick={reset}>
          <RotateCw className="size-4" strokeWidth={1.7} /> Reintentar
        </Button>
      </div>
    </Card>
  );
}
