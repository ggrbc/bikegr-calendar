/**
 * The bikegr.org header for the standalone calendar pages (not the Embed): white band, the GGRBC
 * logo on the left, a text nav and the DONATE pill on the right. Every link goes to www.bikegr.org.
 * Measured on www.bikegr.org (2026-10-10): header 118 px high (82 px on a phone), nav Open Sans 300
 * at 15.84 px in #424142, DONATE Chivo 400 at 12.8 px, uppercase, padding 15.36 px 25.6 px, pill.
 *
 * The logo is drawn here (a green circle with a white bicycle and the name in Chivo), not loaded
 * from the Squarespace CDN, so the header does not depend on a file that Bike GR can replace.
 */

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

export function BikeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#98ac43" />
      <g fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="15" cy="28" r="6" />
        <circle cx="33" cy="28" r="6" />
        <path d="M15 28 L21 17 H30 M19.5 17 H23.5 M21 17 L26 28 L31 19 M29 15.5 H33.5 M26 28 H15 M31 19 L33 28" />
      </g>
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="bg-white text-brand-gray">
      <div className="mx-auto flex h-[82px] max-w-[1280px] items-center justify-between gap-6 px-6 sm:h-[118px] sm:px-[38px]">
        <a href={`${SITE}/`} className="flex items-center gap-3" aria-label="Greater Grand Rapids Bicycle Coalition (bikegr.org)">
          <BikeMark className="size-[30px] sm:size-[74px]" />
          <span className="font-chivo text-[17px] tracking-wide sm:hidden">GGRBC</span>
          <span className="hidden font-chivo text-[21px] uppercase leading-[1.15] tracking-[0.06em] sm:block">
            Greater Grand Rapids
            <br />
            Bicycle Coalition
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
