export function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
}
