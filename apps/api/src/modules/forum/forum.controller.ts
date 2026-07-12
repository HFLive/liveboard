import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  CreateForumCategoryDto,
  CreateForumPostDto,
  CreateForumThreadDto,
  UpdateForumCategoryDto,
  UpdateForumPostDto,
  UpdateForumThreadDto,
} from "./forum.dto";
import { ForumService } from "./forum.service";

@Controller("forum")
export class ForumController {
  constructor(private readonly forumService: ForumService) {}

  @Get("overview")
  async overview(@CurrentUserId() userId: string | null) {
    return this.forumService.listOverview(userId);
  }

  @Get("categories")
  async categories(@CurrentUserId() userId: string | null) {
    return {
      categories: await this.forumService.listCategoriesForAdmin(userId),
    };
  }

  @Post("categories")
  async createCategory(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateForumCategoryDto,
  ) {
    return {
      category: await this.forumService.createCategory(userId, body),
    };
  }

  @Patch("categories/:id")
  async updateCategory(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: UpdateForumCategoryDto,
  ) {
    return {
      category: await this.forumService.updateCategory(userId, id, body),
    };
  }

  @Delete("categories/:id")
  async deleteCategory(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return this.forumService.deleteCategory(userId, id);
  }

  @Get("threads/:id")
  async thread(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return {
      thread: await this.forumService.getThread(userId, id),
    };
  }

  @Post("threads")
  async createThread(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateForumThreadDto,
  ) {
    return {
      thread: await this.forumService.createThread(userId, body),
    };
  }

  @Patch("threads/:id")
  async updateThread(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: UpdateForumThreadDto,
  ) {
    return {
      thread: await this.forumService.updateThread(userId, id, body),
    };
  }

  @Delete("threads/:id")
  async archiveThread(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return this.forumService.archiveThread(userId, id);
  }

  @Post("threads/:id/posts")
  async createPost(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: CreateForumPostDto,
  ) {
    return {
      post: await this.forumService.createPost(userId, id, body),
    };
  }

  @Patch("posts/:id")
  async updatePost(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: UpdateForumPostDto,
  ) {
    return {
      post: await this.forumService.updatePost(userId, id, body),
    };
  }

  @Delete("posts/:id")
  async deletePost(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return this.forumService.deletePost(userId, id);
  }
}
