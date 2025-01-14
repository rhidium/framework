import {
  APIActionRowComponent,
  APIActionRowComponentTypes,
  APIMessageActionRowComponent,
  ActionRowBuilder,
  ActionRowComponentData,
  ActionRowData,
  AnyComponentBuilder,
  BaseInteraction,
  BaseMessageOptions,
  BaseSelectMenuBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  ComponentType,
  DiscordAPIError,
  DiscordjsError,
  InteractionReplyOptions,
  JSONEncodable,
  RepliableInteraction,
  SlashCommandBooleanOption,
} from 'discord.js';
import { DiscordConstants, InteractionConstants, UnitConstants } from '../constants';
import { Client } from '../client';
import { AvailableGuildInteraction } from '../commands/Controllers';

export interface InteractionReplyDynamicOptions {
  preferFollowUp?: boolean;
}

export type PromptConfirmationOptions = {
  client: Client,
  interaction: RepliableInteraction,
  content?: InteractionReplyOptions,
  options?: InteractionReplyDynamicOptions,
  onConfirm?: (interaction: ButtonInteraction) => void | Promise<void>,
  onCancel?: (interaction: ButtonInteraction) => void | Promise<void>,
  shouldReplyOnConfirm?: boolean,
  shouldReplyOnCancel?: boolean,
  removeComponents?: boolean,
  disableComponents?: boolean,
  removeEmbeds?: boolean,
  removeFiles?: boolean,
};

/**
   * Resolves the applicable reply function for the given interaction
   *
   * Note: This is function should never be assigned to a variable, as it's purpose is
   * dynamically resolving the reply function for the given interaction. If you
   * assign this to a variable, it will always resolve to the same function.
   *
   * Example:
   * ```ts
   * InteractionUtils.replyFn(interaction)(content);
   * ```
   * @returns The applicable reply function for the given interaction and options
   */
const replyFn = <I extends BaseInteraction>(
  client: Client,
  interaction: I,
  options?: InteractionReplyDynamicOptions,
) => {
  const { logger } = client;
  if (!interaction.isRepliable()) {
    const noop = async (content: InteractionReplyOptions) =>
      new Promise<null>(() => {
        logger.warn(
          `Interaction ${interaction.id} is not repliable, and cannot be replied to - returning no-operation`,
        );
        logger.warn(
          'This is very likely a bug in your code, and you should analyze the content below to determine the issue:',
        );
        logger.startLog('Non-repliable Interaction Content');
        console.table(content);
        logger.endLog('Non-repliable Interaction Content');
      });
    return noop;
  }

  // Bind interaction to applicable reply function
  if (options?.preferFollowUp) return interaction.followUp.bind(interaction);
  else if (interaction.replied || interaction.deferred) return interaction.editReply.bind(interaction);
  else {
    // Fail-safe - no reply after DiscordConstants.MS_UNTIL_INTERACTION_EXPIRES
    // but interaction wasn't deferred or replied to
    if (
      interaction.createdTimestamp <
        Date.now().valueOf() - DiscordConstants.MS_UNTIL_INTERACTION_EXPIRES
    ) {
      return async (content: InteractionReplyOptions) =>
        new Promise<null>(() => {
          logger.error(
            `Interaction ${interaction.id} was not replied to, and has expired - returning no-operation`,
          );
          logger.warn(
            'This is very likely a bug in your code, and you should analyze the content below to determine the issue:',
          );
          logger.startLog('Expired Interaction Content');
          console.table(content);
          logger.endLog('Expired Interaction Content');
        });
    }
    return interaction.reply.bind(interaction);
  }
};

/**
   * Reply to an interaction - dynamically resolves the reply function,
   * and calls it with the given content, util to avoid having to
   * directly invoke the replyFn method, as explained in it's declaration
   * 
   * Note: It definitely needs the client, as it needs to be able to
   * log critical errors if they are encountered while replying
   * to interactions - it's worth all the client not null checks
   *
   * @returns Reply method return value - use `fetchReply` if appropriate
   */
const replyDynamic = async <I extends BaseInteraction>(
  client: Client,
  interaction: I,
  content: InteractionReplyOptions,
  options?: InteractionReplyDynamicOptions,
) => {
  const { logger } = client;
  const replyFn = InteractionUtils.replyFn(client, interaction, options);
  const logReplyErr = (err: unknown, ctx: InteractionReplyOptions) => {
    const msg =
        err instanceof DiscordjsError || err instanceof DiscordAPIError
          ? err.message
          : `${err}`;
    logger.error(
      `Failed to reply to interaction ${interaction.id} - ${msg}`,
    );
    logger.warn(
      'Above error encountered while attempting to reply to interaction with following content:',
    );
    logger.startLog('Interaction Content');
    console.dir(ctx, { depth: Infinity });
    logger.endLog('Interaction Content');
  };

  try {
    return await replyFn(content);
  } catch (err) {
    logReplyErr(err, content);
    const errCtx = {
      content: client.I18N.t('lib:commands.errorWhileReplyingToInteraction'),
      ephemeral: true,
    };
    await replyFn(errCtx).catch((err: unknown) => {
      logReplyErr(err, errCtx);
    });
    return null;
  }
};

const resolveRowsFromComponents = (components: (AnyComponentBuilder | null)[]) => {
  const rows = [];
  let currentRow = [];
  for (const component of components) {
    if (currentRow.length === 5 || component === null) {
      rows.push(currentRow);
      currentRow = [];
    }
    currentRow.push(component);
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
};

const channelTypeToString = (type: ChannelType): string => {
  switch (type) {
  case ChannelType.GuildText: return 'Text';
  case ChannelType.GuildVoice: return 'Voice';
  case ChannelType.GuildCategory: return 'Category';
  case ChannelType.GuildStageVoice: return 'Stage';
  case ChannelType.PublicThread: return 'Public Thread';
  case ChannelType.PrivateThread: return 'Private Thread';
  case ChannelType.GuildAnnouncement: return 'Announcement';
  case ChannelType.AnnouncementThread: return 'Announcement Thread';
  case ChannelType.DM: return 'DM';
  case ChannelType.GroupDM: return 'Group DM';
  case ChannelType.GuildForum: return 'Guild Forum';
  case ChannelType.GuildDirectory: return 'Guild Directory';
  default: return 'Unknown';
  }
};

const requireGuild = <I extends BaseInteraction>(
  client: Client,
  interaction: BaseInteraction
): interaction is AvailableGuildInteraction<I> => {
  if (!interaction.inGuild()) {
    InteractionUtils.replyDynamic(client, interaction, {
      content: client.I18N.t('lib:commands.notAvailableInDMs'),
      ephemeral: true,
    });
    return false;
  }

  if (!interaction.inCachedGuild()) {
    InteractionUtils.replyDynamic(client, interaction, {
      content: client.I18N.t('lib:commands.missingCachedServer'),
      ephemeral: true,
    });
    return false;
  }

  return true;
};

const requireAvailableGuild = <I extends BaseInteraction>(
  client: Client,
  interaction: I
): interaction is AvailableGuildInteraction<I> => {
  if (!InteractionUtils.requireGuild(client, interaction)) return false;
  if (!interaction.guild.available) {
    InteractionUtils.replyDynamic(client, interaction, {
      content: client.I18N.t('lib:commands.serverUnavailable'),
      ephemeral: true,
    });
    return false;
  }

  interaction.channel;
  interaction.member;
  interaction.guild;
  interaction.guildId;
  interaction.guildLocale;
  
  return true;
};

const paginator = async (
  id: string,
  client: Client,
  pages: BaseMessageOptions[],
  interaction: RepliableInteraction,
  duration = UnitConstants.MS_IN_ONE_HOUR,
  options?: InteractionReplyDynamicOptions,
) => {
  const goToFirstId = `@pagination:${id}:first`;
  const goToPreviousId = `@pagination:${id}:previous`;
  const goToNextId = `@pagination:${id}:next`;
  const goToLastId = `@pagination:${id}:last`;
  const paginationIds = [ goToFirstId, goToPreviousId, goToNextId, goToLastId ];

  let pageNow = 0;
  const isOnFirstPage = () => pageNow === 0;
  const isOnLastPage = () => pageNow === pages.length - 1;
  const controlRow = (forceDisable = false) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(goToFirstId)
      .setDisabled(forceDisable || isOnFirstPage())
      .setLabel('First')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(goToPreviousId)
      .setDisabled(forceDisable || isOnFirstPage())
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(goToNextId)
      .setDisabled(forceDisable || isOnLastPage())
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(goToLastId)
      .setDisabled(forceDisable || isOnLastPage())
      .setLabel('Last')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Primary),
  );

  const paginator = async (page: number) => {
    const content = pages[page];
    if (!content) return;
    await interaction.editReply({
      ...content,
      components: [ controlRow() ],
      ...options,
    });
  };

  const initialReply = await InteractionUtils.replyDynamic(client, interaction, {
    ...pages[0],
    components: [ controlRow() ],
    fetchReply: true,
    ...options,
  });

  if (!initialReply) {
    InteractionUtils.replyDynamic(client, interaction, {
      content: client.I18N.t('lib:commands.missingInitialReply'),
      ephemeral: true,
      ...options,
    });
    return;
  }

  const collector = initialReply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: duration,
    filter: (i) => paginationIds.includes(i.customId),
  });

  collector.on('collect', async (button) => {
    if (button.user.id !== interaction.user.id) {
      InteractionUtils.replyDynamic(client, interaction, {
        content: client.I18N.t('lib:commands.isNotUserPaginator'),
        ephemeral: true,
        ...options,
      });
      return;
    }

    await button.deferUpdate();

    if (button.customId === goToFirstId) {
      pageNow = 0;
      await paginator(pageNow);
    }

    if (button.customId === goToPreviousId) {
      if (pageNow === 0) pageNow = pages.length - 1;
      else pageNow--;
      await paginator(pageNow);
    }

    if (button.customId === goToNextId) {
      if (pageNow === pages.length - 1) pageNow = 0;
      else pageNow++;
      await paginator(pageNow);
    }

    if (button.customId === goToLastId) {
      pageNow = pages.length - 1;
      await paginator(pageNow);
    }
  });

  collector.on('end', async () => {
    await initialReply.edit({
      components: [controlRow(true)],
    });
  });
};

const disableComponents = (
  components: (
    AnyComponentBuilder
    | APIActionRowComponent<APIMessageActionRowComponent>
    | JSONEncodable<APIActionRowComponent<APIMessageActionRowComponent>>
    | ActionRowData<JSONEncodable<APIActionRowComponentTypes> | ActionRowComponentData>
  )[]
) => components.map((component) => {
  if (component instanceof ActionRowBuilder) {
    for (const innerComponent of component.components) {
      if (
        innerComponent instanceof ButtonBuilder
        || innerComponent instanceof BaseSelectMenuBuilder
      ) innerComponent.setDisabled(true);
    }
  }
  return component;
});

const slashConfirmationOptionName = 'confirmation';
const addSlashConfirmationOption = (i: SlashCommandBooleanOption) => i
  .setName(slashConfirmationOptionName)
  .setDescription('Are you sure you want to perform this action?')
  .setRequired(false);

const slashConfirmationOptionHandler = (
  client: Client,
  interaction: ChatInputCommandInteraction,
): boolean => {
  const value = interaction.options.getBoolean(slashConfirmationOptionName);
  if (!value) {
    InteractionUtils.replyDynamic(client, interaction, {
      content: client.I18N.t('lib:commands.confirmationRequired'),
      ephemeral: true,
    });
    return false;
  }
  return true;
};

const confirmationButtonRow = (client: Client) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId(InteractionConstants.CONFIRMATION_BUTTON_CONFIRM_ID)
    .setLabel(client.I18N.t('lib:commands.confirmationButtonLabel'))
    .setEmoji(client.clientEmojis.success)
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId(InteractionConstants.CONFIRMATION_BUTTON_CANCEL_ID)
    .setLabel(client.I18N.t('lib:commands.cancelButtonLabel'))
    .setEmoji(client.clientEmojis.error)
    .setStyle(ButtonStyle.Secondary),
);

const promptConfirmation = async ({
  client,
  interaction,
  content,
  options,
  onConfirm,
  onCancel,
  shouldReplyOnConfirm = false,
  shouldReplyOnCancel = true,
  removeComponents = true,
  disableComponents = true,
  removeEmbeds = true,
  removeFiles = true,
}: PromptConfirmationOptions): Promise<RepliableInteraction | false | 'expired'> => {
  if (!content) content = {};
  if (!content.components) content.components = [];
  if (!content.embeds) content.embeds = [];
  if (!content.files) content.files = [];

  const newEmbeds = removeEmbeds ? [] : content.embeds;
  const newFiles = removeFiles ? [] : content.files;
  const confirmationRow = confirmationButtonRow(client);
  const components = content.components.length
    ? [ ...content.components, confirmationRow ]
    : [ confirmationRow ];

  const message = await InteractionUtils.replyDynamic(client, interaction, {
    content: client.I18N.t('lib:commands.promptConfirmation'),
    ...content,
    ...options,
    components,
    fetchReply: true,
  });

  if (!message) {
    InteractionUtils.replyDynamic(client, interaction, {
      content: client.I18N.t('lib:commands.missingInitialReply'),
      ephemeral: true,
    });
    return false;
  }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: UnitConstants.MS_IN_ONE_MINUTE,
  });

  return await new Promise<RepliableInteraction | false | 'expired'>((resolve) => {
    collector.on('collect', async (button) => {
      if (button.user.id !== interaction.user.id) {
        InteractionUtils.replyDynamic(client, interaction, {
          content: client.I18N.t('lib:commands.isNotComponentUser'),
          ephemeral: true,
        });
        return;
      }
  
      if (button.customId === InteractionConstants.CONFIRMATION_BUTTON_CONFIRM_ID) {
        if (shouldReplyOnConfirm) await button.deferUpdate();
        if (typeof onConfirm === 'function') await onConfirm(button);
        if (disableComponents) InteractionUtils.disableComponents(components);
        if (shouldReplyOnConfirm) await InteractionUtils.replyDynamic(client, button, {
          content: client.I18N.t('lib:commands.confirmationAccepted'),
          embeds: newEmbeds,
          files: newFiles,
          components: removeComponents ? [] : components,
        });
        resolve(button);
      }
  
      if (button.customId === InteractionConstants.CONFIRMATION_BUTTON_CANCEL_ID) {
        if (shouldReplyOnCancel) await button.deferUpdate();
        if (typeof onCancel === 'function') await onCancel(button);
        if (disableComponents) InteractionUtils.disableComponents(components);
        if (shouldReplyOnCancel) await InteractionUtils.replyDynamic(client, button, {
          content: client.I18N.t('lib:commands.confirmationCancelled'),
          embeds: newEmbeds,
          files: newFiles,
          components: removeComponents ? [] : components,
        });
        resolve(false);
      }
    });

    collector.on('end', async (collected) => {
      if (collected.size) return;
      InteractionUtils.disableComponents(components);
      await InteractionUtils.replyDynamic(client, interaction, {
        content: client.I18N.t('lib:commands.confirmationExpired'),
        embeds: newEmbeds,
        files: newFiles,
        components: components,
      });
      resolve('expired');
    });
  });
};

export class InteractionUtils {
  static readonly replyFn = replyFn;
  static readonly replyDynamic = replyDynamic;
  static readonly resolveRowsFromComponents = resolveRowsFromComponents;
  static readonly channelTypeToString = channelTypeToString;
  static readonly requireGuild = requireGuild;
  static readonly requireAvailableGuild = requireAvailableGuild;
  static readonly paginator = paginator;
  static readonly disableComponents = disableComponents;
  static readonly addSlashConfirmationOption = addSlashConfirmationOption;
  static readonly slashConfirmationOptionHandler = slashConfirmationOptionHandler;
  static readonly confirmationButtonRow = confirmationButtonRow;
  static readonly promptConfirmation = promptConfirmation;
}
