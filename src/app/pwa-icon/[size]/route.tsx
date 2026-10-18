import { ImageResponse } from "next/og";

const SIZES = new Set([192, 512]);

// The three Kanbo column bars on the warm background. `maskable` icons keep the artwork
// inside the 80% safe zone so Android can crop them to any shape.
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = Number(raw);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.has("maskable");
  const scale = size * (maskable ? 0.5 : 0.62);
  const bar = scale / 3.6;
  const gap = bar * 0.3;
  const heights = [1, 0.78, 0.56].map((h) => h * scale);
  const colors = ["#78350F", "#9A3412", "#D97706"];
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff8f6",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap, height: scale }}>
        {heights.map((height, index) => (
          <div
            key={index}
            style={{
              width: bar,
              height,
              background: colors[index],
              borderRadius: bar * 0.3,
            }}
          />
        ))}
      </div>
    </div>,
    { width: size, height: size },
  );
}
