/**
 * The bikegr.org header for the standalone calendar pages (not the Embed): white band, the GGRBC
 * logo on the left, a text nav and the DONATE pill on the right. Every link goes to www.bikegr.org.
 * Measured on www.bikegr.org (2026-10-10): header 118 px high (82 px on a phone), nav Open Sans 300
 * at 15.84 px in #424142, DONATE Chivo 400 at 12.8 px, uppercase, padding 15.36 px 25.6 px, pill.
 *
 * The logo is Bike GR's own file (public/brand/, from the brand identity kit): the primary logo on
 * desktop, the circle icon with "GGRBC" on a phone, as on bikegr.org. `next/image` with a fixed
 * width and height, so the layout does not shift.
 */
import Image from "next/image";

const SITE = "https://www.bikegr.org";

export const SITE_NAV = [
  { label: "Get Involved", href: `${SITE}/volunteering` },
  { label: "Resources", href: `${SITE}/maps` },
  { label: "News", href: `${SITE}/news` },
  { label: "Events", href: `${SITE}/events` },
  { label: "About Us", href: `${SITE}/about-us` },
  { label: "Contact", href: `${SITE}/contact` },
];

const DONATE = `${SITE}/donate`;

export function SiteHeader() {
  return (
    <header className="bg-white text-brand-gray">
      <div className="mx-auto flex h-[82px] max-w-[1280px] items-center justify-between gap-6 px-6 sm:h-[118px] sm:px-[38px]">
        <a href={`${SITE}/`} className="flex items-center gap-3">
          <Image
            src="/brand/ggrbc-logo-primary.png"
            alt="Greater Grand Rapids Bicycle Coalition"
            width={345}
            height={75}
            priority
            className="hidden h-[75px] w-[345px] sm:block"
          />
          <Image
            src="/brand/ggrbc-logo-icon.png"
            alt="Greater Grand Rapids Bicycle Coalition"
            width={30}
            height={30}
            priority
            className="size-[30px] sm:hidden"
          />
          <span aria-hidden="true" className="font-chivo text-[17px] tracking-wide sm:hidden">
            GGRBC
          </span>
        </a>

        <nav aria-label="bikegr.org" className="hidden items-center gap-8 lg:flex">
          {SITE_NAV.map((item) => (
            <a key={item.label} href={item.href} className="text-[15.84px] font-light hover:underline">
              {item.label}
            </a>
          ))}
          <a
            href={DONATE}
            className="rounded-[300px] bg-brand-orange-text px-[25.6px] py-[15.36px] font-chivo text-[12.8px] uppercase tracking-[0.02em] text-white hover:bg-brand-gray"
          >
            Donate
          </a>
        </nav>

        <details className="relative lg:hidden">
          <summary className="flex size-11 cursor-pointer list-none flex-col items-center justify-center gap-[7px] [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Menu</span>
            <span aria-hidden="true" className="block h-px w-9 bg-brand-gray" />
            <span aria-hidden="true" className="block h-px w-9 bg-brand-gray" />
          </summary>
          <nav
            aria-label="bikegr.org"
            className="absolute right-0 z-10 mt-2 flex w-56 flex-col gap-3 bg-white p-5 shadow-lg"
          >
            {SITE_NAV.map((item) => (
              <a key={item.label} href={item.href} className="text-[15.84px] font-light">
                {item.label}
              </a>
            ))}
            <a
              href={DONATE}
              className="mt-2 self-start rounded-[300px] bg-brand-orange-text px-[25.6px] py-[12px] font-chivo text-[12.8px] uppercase text-white"
            >
              Donate
            </a>
          </nav>
        </details>
      </div>
    </header>
  );
}
