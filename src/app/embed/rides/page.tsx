import { EmbedPage, embedMetadata } from "../_components/embed-page";

export const metadata = embedMetadata("rides");

/** Blocking: the first HTML has the events, also without JavaScript. */
export const instant = false;

export default function RidesEmbed({ searchParams }: PageProps<"/embed/rides">) {
  return <EmbedPage calendar="rides" searchParams={searchParams} />;
}
