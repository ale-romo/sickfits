const Mutation = {
  async createItem(partent, args, ctx, info){
    const item = await ctx.db.mutation.createItem({
      data: {
        ...args
      }
    }, info);
    
    return item;
  }
};

module.exports = Mutation;
