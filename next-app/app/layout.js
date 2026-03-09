import "./globals.css";
import Providers from "./providers";
import ToastContainer from "@/components/ToastContainer";

export const metadata = {
  title: "SkillsXAI Meet",
  description: "Premium video meetings with whiteboard, screen sharing, recording & collaboration tools",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ToastContainer />
          {children}
        </Providers>
      </body>
    </html>
  );
}
