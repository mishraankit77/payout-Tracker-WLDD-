import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: "meme’d — Campaign Payout Tracker",
  description: 'Launch creator campaigns, track milestones, and manage budget-aware payouts.',
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
