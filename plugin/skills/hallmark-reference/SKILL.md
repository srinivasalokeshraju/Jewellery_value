---
name: hallmark-reference
description: This skill should be used when reading a purity stamp or hallmark on gold or silver jewellery, such as 916, 22K, 750, 925, sterling, or the BIS logo, or when a stamp may mean the piece is plated or filled, such as GP, GF, HGE, RGP, or EPNS. It lists what each mark means, with a source for each table.
---

# Hallmark reference

Use these tables to read a stamp. Pass purity to the melt-value tools by the purity rule in the `value-jewellery` skill. These tables explain a mark to the person. They do not replace the server's purity check.

A mark that is not in these tables is not proof of anything. Pass it to the server as written. If the server rejects it, ask the person what the mark says or means.

## Plated and filled marks

These marks mean that only a thin surface layer is precious metal. The piece has no meaningful melt value. Do not call `calc_melt_value` for it.

| Mark | Meaning | Source |
|---|---|---|
| `GF`, Gold Filled | Gold alloy of at least 10K bonded by a mechanical process, at least 1/20 of the metal's weight | US FTC Guides, 16 CFR 23.3 |
| `RGP`, Rolled Gold Plate | Gold alloy of at least 10K bonded by a mechanical process, with the share of the weight stated in the mark, such as 1/40 | US FTC Guides, 16 CFR 23.3 |
| `GP`, Gold Plate | Gold alloy of at least 10K bonded by a mechanical process, at least 1/40 of the metal's weight | US FTC Guides, 16 CFR 23.3 |
| `GEP`, Gold Electroplate | Electroplated gold of at least 10K, at least 0.175 microns thick | US FTC Guides, 16 CFR 23.3 |
| `HGE`, Heavy Gold Electroplate | Electroplated gold of at least 10K, at least 2.5 microns thick | US FTC Guides, 16 CFR 23.3 |
| `EPNS`, Electroplated Nickel Silver | Silver plate on nickel silver, a base metal | Birmingham Assay Office |
| `EPBM`, `Silver Plate` | Silver plate on a base metal | Birmingham Assay Office |

Birmingham Assay Office source: https://www.theassayoffice.co.uk/our-services/hallmarking/silver-assay-and-hallmarking/

A UK hallmark on gold-plated silver is a silver hallmark. Value such a piece as silver, from its silver mark. Source: the UK guidance notes cited below.

## India (BIS hallmark)

A BIS hallmark on gold has three parts since 1 July 2021. The BIS logo, the purity in karat and fineness, and a six-character HUID code.

| Mark | Karat | Gold content |
|---|---|---|
| `24K995` | 24K | 99.5% |
| `23K958` | 23K | 95.8% |
| `22K916` | 22K | 91.6% |
| `20K833` | 20K | 83.3% |
| `18K750` | 18K | 75.0% |
| `14K585` | 14K | 58.5% |

Source: Bureau of Indian Standards, "Hallmarking of Gold Jewellery & Artefacts", 20 October 2022, https://services.bis.gov.in/php/BIS_2.0/BISBlog/?p=560

The server does not accept the joined form, such as `22K916`. Both parts state the same purity, so pass the fineness part, such as `916`.

The HUID is an identity code, not a purity. Never pass it as a purity.

This skill has no India silver table. The sources found disagree on the current silver grades, so it lists none. Pass a silver mark such as `925` as written.

## United Kingdom

A UK hallmark has three compulsory marks. The sponsor's mark, the millesimal fineness mark, and the assay office mark. A date letter and a traditional symbol, such as the lion for sterling silver, are optional.

| Metal | Fineness marks |
|---|---|
| Gold | `999`, `990`, `916`, `750`, `585`, `375` |
| Silver | `999`, `958`, `925`, `800` |

`916` is 22 carat, `750` is 18 carat, `585` is 14 carat, and `375` is 9 carat. `925` is sterling silver.

Source: Assay Offices of Great Britain, "Hallmarking Guidance Notes, practical guidance in relation to the Hallmarking Act 1973", November 2022, https://assets.publishing.service.gov.uk/media/63a333b9d3bf7f37654767e0/hallmarking-guidance-notes.pdf

## European Union and the Hallmarking Convention

The EU has no single hallmark law. Many European countries sign the International Hallmarking Convention, and its Common Control Mark is recognised in every member country. The mark shows the fineness inside a shape that names the metal.

| Metal | Convention fineness marks |
|---|---|
| Gold | `999`, `990`, `916`, `750`, `585`, `375` |
| Silver | `999`, `958`, `925`, `800` |

Source: the same Assay Offices of Great Britain guidance notes, November 2022, section "The Common Control Mark and Convention Marks".

National marks in each EU country are not listed here.

## United States

The FTC Guides govern what a US mark may claim.

| Mark | Meaning |
|---|---|
| A karat mark with gold, such as `10K`, `14K`, `18K` | Gold alloy of that karat throughout |
| `Sterling`, `Sterling Silver`, `Ster.` | At least 925 parts per thousand silver |
| `Coin`, `Coin Silver` | At least 900 parts per thousand silver |

Source: US FTC Guides for the Jewelry, Precious Metals, and Pewter Industries, 16 CFR 23.3 and 23.5, https://www.law.cornell.edu/cfr/text/16/part-23
