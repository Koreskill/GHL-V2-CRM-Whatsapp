// Corre antes de pintar: aplica la clase "dark" según la preferencia guardada (o la del sistema),
// así no hay un destello de tema claro al recargar. El script es una constante: no toma entrada de nadie.
const SCRIPT = `(function(){try{var t=localStorage.getItem("crm_theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
