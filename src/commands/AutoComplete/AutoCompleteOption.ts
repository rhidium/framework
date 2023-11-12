import {
  APIApplicationCommandOptionChoice,
  ApplicationCommandOptionChoiceData,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  DiscordAPIError,
  SlashCommandStringOption,
} from 'discord.js';
import { Client } from '../../client';
import { DiscordConstants } from '../../constants';
import { InteractionUtils } from '../../utils';
import Lang from '../../i18n/i18n';

export enum AutoCompleteResponseType {
  MISSING_REQUIRED = 'missing_required',
}

// Type guard function to check if the value is an instance of AutoCompleteResponseType
export const isAutoCompleteResponseType = (
  value: unknown,
): value is AutoCompleteResponseType => {
  if (typeof value !== 'string') return false;
  return Object.values(AutoCompleteResponseType).includes(
    value as AutoCompleteResponseType,
  );
};

export type AutoCompleteRunFunction = (
  query: string,
  client: Client<true>,
  interaction: AutocompleteInteraction,
) =>
  | ApplicationCommandOptionChoiceData[]
  | Promise<ApplicationCommandOptionChoiceData[]>;

export type AutoCompleteGetValueFunction<T> = (
  rawValue: string,
  client: Client<true>,
  interaction: ChatInputCommandInteraction,
) => T | null | Promise<T | null>;

export interface AutoCompleteOptions<T = undefined> {
  /**
   * The name for this auto-complete option, this should be unique.
   */
  name: string;
  /**
   * The description for this auto-complete option.
   */
  description: string;
  /**
   * The function that responds to the auto-complete option.
   */
  run: AutoCompleteRunFunction;
  /**
   * The function that gets the resolved value of the auto-complete option.
   * Returns raw value by default.
   */
  resolveValue?: T extends undefined
    ? undefined
    : AutoCompleteGetValueFunction<T>;
  /**
   * The minimum length for the auto-complete option.
   */
  minLength?: number;
  /**
   * The maximum length for the auto-complete option.
   */
  maxLength?: number;
  /**
   * Whether this auto-complete option is required.
   */
  required?: boolean;
  /**
   * The choices for this auto-complete option.
   */
  choices?: APIApplicationCommandOptionChoice<string>[];
  /**
   * Should the query be trimmed before being passed to the run function?
   */
  trimQuery?: boolean;
  /**
   * Should the query be lowercased before being passed to the run function?
   */
  lowercaseQuery?: boolean;
  /**
   * Should warnings about Unknown Interaction errors be suppressed?
   */
  suppressUnknownInteractionErrors?: boolean;
}

export class AutoCompleteOption<T = undefined> {
  client?: Client<true>;
  name: string;
  data: SlashCommandStringOption;
  run: AutoCompleteRunFunction;
  resolveValue:
    | (T extends undefined ? undefined : AutoCompleteGetValueFunction<T>)
    | undefined;
  trimQuery = true;
  lowercaseQuery = true;
  suppressUnknownInteractionErrors = false;
  addOptionHandler = (i: SlashCommandStringOption) => {
    i.setAutocomplete(true)
      .setName(this.name)
      .setDescription(this.data.description)
      .setRequired(this.data.required);
    if (this.data.min_length) i.setMinLength(this.data.min_length);
    if (this.data.max_length) i.setMaxLength(this.data.max_length);
    return i;
  };
  constructor(options: AutoCompleteOptions<T>, client?: Client<true>) {
    this.name = options.name;
    const data = new SlashCommandStringOption()
      .setAutocomplete(true)
      .setName(options.name)
      .setDescription(options.description);
    this.run = options.run;
    this.trimQuery = options.trimQuery ?? true;
    this.lowercaseQuery = options.lowercaseQuery ?? true;
    this.suppressUnknownInteractionErrors =
      options.suppressUnknownInteractionErrors ?? false;
    this.resolveValue = options.resolveValue;
    if (options.minLength) data.setMinLength(options.minLength);
    if (options.maxLength) data.setMaxLength(options.maxLength);
    if (options.required) data.setRequired(options.required);
    if (options.choices) data.addChoices(...options.choices);
    if (client) this.client = client;
    this.data = data;
  }

  /**
   * Handle an auto-complete interaction for this option.
   * @param interaction The interaction to handle.
   */
  handleInteraction = async (interaction: AutocompleteInteraction) => {
    if (!this.client) {
      throw new Error(`AutoComplete option ${this.name} has no client`);
    }
    const { logger } = this.client;
    const focusedValue = interaction.options.getFocused();
    let query = focusedValue ?? '';
    if (this.trimQuery) query = query.trim();
    if (this.lowercaseQuery) query = query.toLowerCase();
    if (!this.client) {
      logger.warn(
        `AutoComplete option ${this.name} has no client, ignoring...`,
      );
      return;
    }
    const choices = await this.run(query, this.client, interaction);
    interaction
      .respond(choices.slice(0, DiscordConstants.MAX_AUTO_COMPLETE_COMMAND_CHOICES))
      .catch((err) => {
        if (
          err instanceof DiscordAPIError &&
          err.code === DiscordConstants.UNKNOWN_INTERACTION_ERROR_CODE
        ) {
          if (!this.suppressUnknownInteractionErrors) {
            logger.debug(
              `Error 10062 (Unknown Interaction) encountered for AutoComplete option ${this.name}`,
            );
          }
          return;
        }
      });
  };

  getRawValue = (interaction: ChatInputCommandInteraction) => {
    const value =
      interaction.options.getString(this.name, this.data.required) ?? '';
    return value;
  };

  async getValue(
    interaction: ChatInputCommandInteraction,
    handleMissingWhenRequired: true,
  ): Promise<T | AutoCompleteResponseType.MISSING_REQUIRED>;
  async getValue(
    interaction: ChatInputCommandInteraction,
    handleMissingWhenRequired: boolean = true,
  ): Promise<T | null | AutoCompleteResponseType.MISSING_REQUIRED> {
    if (!this.client) {
      throw new Error(`AutoComplete option ${this.name} has no client`);
    }
    if (!this.resolveValue) {
      throw new Error(
        `AutoComplete option ${this.name} has no resolveValue function, but is being resolved through getValue`,
      );
    }

    const rawValue = this.getRawValue(interaction);
    const resolvedValue = await this.resolveValue(
      rawValue,
      this.client,
      interaction,
    );
    if (!resolvedValue && handleMissingWhenRequired) {
      InteractionUtils.replyDynamic(this.client, interaction, {
        embeds: [
          this.client.embeds.error({
            title: Lang.t('commands.missingRequiredOptionTitle'),
            description: Lang.t('commands.missingRequiredACOptionDescription', { optionName: this.name }),
          }),
        ],
        ephemeral: true,
      });
      return AutoCompleteResponseType.MISSING_REQUIRED;
    }

    return resolvedValue;
  }
}
