import { EmbedPage, embedMetadata } from "../_components/embed-page";

export const metadata = embedMetadata("advocacy");

/** Blocking: the first HTML has the events, also without JavaScript. */
export const instant = false;

export default function AdvocacyEmbed({ searchParams }: PageProps<"/embed/advocacy">) {
  return <EmbedPage calendar="advocacy" searchParams={searchParams} />;
}
