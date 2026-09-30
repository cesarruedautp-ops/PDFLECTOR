const SUPABASE_URL = "https://bnilhzijsxulgczvnyxn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuaWxoemlqc3h1bGdjenZueXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDMyMTAsImV4cCI6MjEwNjE3OTIxMH0.WZXS8qjAnRuQAkph3qOZzAIMJUB8jXLmDj5V0JmJoSQ";

// sessionStorage en vez de localStorage: al cerrar la pestana o el navegador,
// el navegador borra este almacenamiento solo, sin depender de ningun evento
// de "beforeunload" (que no es confiable para llamadas async como signOut()).
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
