import WeddingUploadsClient from './WeddingUploadsClient'

export default function WeddingUploadsApp({ convexUrl }: { convexUrl: string }) {
  return <WeddingUploadsClient convexUrl={convexUrl} />
}
