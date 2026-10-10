import { EmbedPage, embedMetadata } from "../_components/embed-page";

export const metadata = embedMetadata("advocacy");

export default function AdvocacyEmbed({ searchParams }: PageProps<"/embed/advocacy">) {
  return <EmbedPage calendar="advocacy" searchParams={searchParams} />;
}
