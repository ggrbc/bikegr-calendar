import { EmbedPage, embedMetadata } from "../_components/embed-page";

export const metadata = embedMetadata("rides");

export default function RidesEmbed({ searchParams }: PageProps<"/embed/rides">) {
  return <EmbedPage calendar="rides" searchParams={searchParams} />;
}
