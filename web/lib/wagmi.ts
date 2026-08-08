import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { activeChain, monadTestnet, promptpayLocal } from "./chains";

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http(), [promptpayLocal.id]: http() },
});
