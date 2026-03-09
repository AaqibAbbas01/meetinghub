import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getSupabaseServer } from "./lib/supabase-server.js";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/drive.file",
          access_type: "offline",
        },
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      try {
        const db = getSupabaseServer();
        await db.from('users').upsert({
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.image,
        }, { onConflict: 'email', ignoreDuplicates: false });
      } catch (e) {
        console.error('Supabase user upsert error:', e);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id || token.sub;
        session.user.email = token.email;
        session.user.name = token.name;
        session.user.image = token.picture;
        session.accessToken = token.accessToken || null;
      }
      return session;
    },
  },
});
