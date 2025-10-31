export const metadata = { title: "Dvorak Judge" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
      <html lang="ko">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui" }}>
  {children}
  </body>
  </html>
);
}
