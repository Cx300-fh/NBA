import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'COURTSIDE — 每一回合，都值得看懂',description:'NBA 比赛日、官方统计、球员与球队对比，以及你的专属观赛手记。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}
