import { EmbedPage, embedMetadata } from "../_components/embed-page";

export const metadata = embedMetadata(null);

export default function AllEmbed({ searchParams }: PageProps<"/embed/all">) {
  return <EmbedPage calendar={null} searchParams={searchParams} />;
}
