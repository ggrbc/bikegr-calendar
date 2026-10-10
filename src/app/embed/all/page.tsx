import { EmbedPage, embedMetadata } from "../_components/embed-page";

export const metadata = embedMetadata(null);

/** Blocking: the first HTML has the events, also without JavaScript. */
export const instant = false;

export default function AllEmbed({ searchParams }: PageProps<"/embed/all">) {
  return <EmbedPage calendar={null} searchParams={searchParams} />;
}
