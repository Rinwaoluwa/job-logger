import { createContext } from "react";

// How an id in profile text (brightpay-s7, gen-s6, brightpay-m8, proj-meterpay)
// becomes a link. ProfileView provides a resolver built from the story
// index; outside the Profile tab the default resolves nothing and ids
// render as plain chips.
export const ProfileLinkContext = createContext({ resolve: () => null });
