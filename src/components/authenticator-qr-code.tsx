import { encodeQrCode } from "@/lib/qr-code";

const QUIET_ZONE = 4;

export function AuthenticatorQrCode({ uri }: { uri: string }) {
  const matrix = encodeQrCode(uri);
  const size = matrix.length + QUIET_ZONE * 2;
  const path = matrix
    .flatMap((row, y) =>
      row.flatMap((dark, x) =>
        dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : [],
      ),
    )
    .join("");

  return (
    <svg
      aria-label="Authenticator setup QR code"
      className="authenticator-qr"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect className="authenticator-qr__paper" height={size} width={size} />
      <path className="authenticator-qr__modules" d={path} />
    </svg>
  );
}
